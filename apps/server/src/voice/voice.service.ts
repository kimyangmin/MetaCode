import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ChannelRef,
  type PlazaId,
  SocketEvent,
  type VoiceCall,
  type VoiceJoinResult,
  type VoiceMember,
  type VoiceUpdateState,
  getPlazaId,
  proximityGain,
} from '@metacode/shared';
import { AccessService } from '../chat/access.service.js';
import type { Env } from '../config/env.js';
import { PlazaService } from '../plaza/plaza.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { toProfile } from '../users/users.service.js';
import { LiveKitService } from './livekit.service.js';

interface Member extends VoiceMember {
  /** 이 통화에 들어간 실시간 연결. 이 연결이 끊기면 통화에서 뺀다 */
  socketId: string;
}

interface Call {
  channelId: string;
  communityId: string | null;
  plazaId: PlazaId;
  proximity: boolean;
  members: Map<string, Member>;
}

const publicMember = ({ user, muted, deafened, speaking, sharing }: Member): VoiceMember => ({
  user,
  muted,
  deafened,
  speaking,
  sharing,
});

/**
 * 통화 목록과 참여자 상태. 음성 자체는 LiveKit이 나르고, 여기서는 누가 어느 통화에 있는지,
 * 음소거/말하는 중 같은 상태, 근접 음성 음량을 관리해서 알린다.
 *
 * - 한 사람은 통화 하나에만 있다. 다른 통화에 들어가면 앞의 통화에서 뺀다.
 * - 통화는 그 통화에 들어간 실시간 연결에 묶인다. 연결이 끊기고 잠시(VOICE_DISCONNECT_GRACE_MS) 안에
 *   다시 들어오지 않으면 뺀다.
 * - 상태는 메모리에만 둔다 (Presence와 같이 서버 한 대 전제). 서버가 다시 시작하면 클라이언트가 다시 들어온다.
 */
@Injectable()
export class VoiceService implements OnModuleDestroy {
  private readonly calls = new Map<string, Call>();
  /** userId → 들어가 있는 통화의 channelId */
  private readonly callOf = new Map<string, string>();
  private readonly leaveTimers = new Map<string, NodeJS.Timeout>();
  /** 마지막으로 보낸 근접 음성 음량 (같으면 다시 보내지 않는다) */
  private readonly sentGains = new Map<string, string>();
  private readonly graceMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly plaza: PlazaService,
    private readonly realtime: RealtimeService,
    private readonly livekit: LiveKitService,
    config: ConfigService<Env, true>,
  ) {
    this.graceMs = config.get('VOICE_DISCONNECT_GRACE_MS');
  }

  onModuleDestroy(): void {
    for (const timer of this.leaveTimers.values()) clearTimeout(timer);
  }

  /** 이 사람이 볼 수 있는 진행 중인 통화 전부 */
  async sync(userId: string): Promise<VoiceCall[]> {
    const visible: VoiceCall[] = [];
    for (const call of this.calls.values()) {
      if (await this.canSee(userId, call.channelId)) visible.push(this.toDto(call));
    }
    return visible;
  }

  async join(userId: string, socketId: string, channelId: string): Promise<VoiceJoinResult> {
    if (!this.livekit.enabled) {
      throw new ServiceUnavailableException('음성 서버가 설정되지 않아 통화할 수 없습니다.');
    }
    const channel = await this.access.getChannel(userId, channelId);
    if (channel.type === 'TEXT') {
      throw new BadRequestException('텍스트 채널에서는 통화할 수 없습니다.');
    }

    const current = this.callOf.get(userId);
    if (current && current !== channelId) await this.removeMember(userId, current, true);
    this.cancelLeave(userId);

    let call = this.calls.get(channelId);
    if (!call) {
      const { proximityVoice } = await this.prisma.channel.findUniqueOrThrow({
        where: { id: channelId },
        select: { proximityVoice: true },
      });
      call = {
        channelId,
        communityId: channel.communityId,
        plazaId: getPlazaId(channel as ChannelRef),
        proximity: proximityVoice,
        members: new Map(),
      };
      this.calls.set(channelId, call);
    }

    let member = call.members.get(userId);
    if (member) {
      // 다시 연결했거나 다른 탭/기기에서 들어왔다. LiveKit이 앞의 연결을 끊는다.
      member.socketId = socketId;
    } else {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      member = {
        user: toProfile(user),
        muted: false,
        deafened: false,
        speaking: false,
        sharing: false,
        socketId,
      };
      call.members.set(userId, member);
      this.callOf.set(userId, channelId);
      this.realtime.emit(room.channel(channelId), SocketEvent.VoiceJoined, {
        channelId,
        member: publicMember(member),
      });
      await this.updateGains(call);
    }

    return {
      url: this.livekit.publicUrl,
      token: await this.livekit.token(channelId, member.user),
      call: this.toDto(call),
    };
  }

  /** 스스로 나간다. 다른 연결이 이미 이 통화를 넘겨받았으면 무시한다 */
  async leave(userId: string, socketId: string): Promise<void> {
    const member = this.memberOf(userId);
    if (member?.socketId !== socketId) return;
    await this.removeMember(userId, this.callOf.get(userId)!, false);
  }

  update(userId: string, socketId: string, state: VoiceUpdateState): void {
    const member = this.memberOf(userId);
    if (member?.socketId !== socketId) return;
    if (
      member.muted === state.muted &&
      member.deafened === state.deafened &&
      member.speaking === state.speaking &&
      member.sharing === state.sharing
    ) {
      return;
    }
    Object.assign(member, state);
    const channelId = this.callOf.get(userId)!;
    this.realtime.emit(room.channel(channelId), SocketEvent.VoiceUpdated, {
      channelId,
      member: publicMember(member),
    });
  }

  /** 근접 음성 켜기/끄기: 그 통화의 참여자 누구나. 채널 설정으로 저장해서 다음 통화에도 유지된다 */
  async setProximity(userId: string, channelId: string, enabled: boolean): Promise<void> {
    const call = this.calls.get(channelId);
    if (!call?.members.has(userId)) {
      throw new ForbiddenException('통화에 참여한 사람만 근접 음성을 바꿀 수 있습니다.');
    }
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { proximityVoice: enabled },
    });
    call.proximity = enabled;
    this.realtime.emit(room.channel(channelId), SocketEvent.VoiceProximityChanged, {
      channelId,
      enabled,
    });
    for (const id of call.members.keys()) this.sentGains.delete(id);
    await this.updateGains(call);
  }

  /** 실시간 연결이 끊겼다. 통화를 가진 연결이면 잠시 기다렸다가 뺀다 */
  disconnected(userId: string, socketId: string): void {
    if (this.memberOf(userId)?.socketId !== socketId) return;
    this.cancelLeave(userId);
    this.leaveTimers.set(
      userId,
      setTimeout(() => {
        this.leaveTimers.delete(userId);
        const channelId = this.callOf.get(userId);
        if (channelId && this.memberOf(userId)?.socketId === socketId) {
          void this.removeMember(userId, channelId, true);
        }
      }, this.graceMs),
    );
  }

  /** 광장에서 움직였다: 그 광장의 근접 음성 통화면 음량을 다시 계산한다 */
  async moved(plazaId: PlazaId, userId: string): Promise<void> {
    const channelId = this.callOf.get(userId);
    const call = channelId ? this.calls.get(channelId) : undefined;
    if (call?.proximity && call.plazaId === plazaId) await this.updateGains(call);
  }

  /** 커뮤니티를 나갔다: 그 커뮤니티의 음성 채널에 있었으면 뺀다 */
  async leftCommunity(userId: string, communityId: string): Promise<void> {
    const channelId = this.callOf.get(userId);
    if (channelId && this.calls.get(channelId)?.communityId === communityId) {
      await this.removeMember(userId, channelId, true);
    }
  }

  /** 채널 권한이 바뀌었다: 볼 수 없게 된 음성 채널의 통화에서 뺀다 */
  async revalidateCommunity(communityId: string): Promise<void> {
    for (const call of [...this.calls.values()]) {
      if (call.communityId !== communityId) continue;
      for (const userId of [...call.members.keys()]) {
        if (!(await this.canSee(userId, call.channelId))) {
          await this.removeMember(userId, call.channelId, true);
        }
      }
    }
  }

  /** 커뮤니티가 삭제됐다: 그 커뮤니티의 통화를 모두 끝낸다 */
  async communityDeleted(communityId: string): Promise<void> {
    for (const call of [...this.calls.values()]) {
      if (call.communityId !== communityId) continue;
      for (const userId of [...call.members.keys()]) {
        await this.removeMember(userId, call.channelId, true);
      }
    }
  }

  private memberOf(userId: string): Member | undefined {
    const channelId = this.callOf.get(userId);
    return channelId ? this.calls.get(channelId)?.members.get(userId) : undefined;
  }

  private async removeMember(userId: string, channelId: string, disconnect: boolean) {
    const call = this.calls.get(channelId);
    if (!call?.members.delete(userId)) return;
    this.callOf.delete(userId);
    this.sentGains.delete(userId);
    this.cancelLeave(userId);
    // 본인에게도 보낸다: 다른 탭/기기가 통화를 넘겨받았거나 커뮤니티를 나가 채널 방에 없을 수 있다.
    this.realtime.emit([room.channel(channelId), room.user(userId)], SocketEvent.VoiceLeft, {
      channelId,
      userId,
    });
    if (call.members.size === 0) this.calls.delete(channelId);
    else await this.updateGains(call);
    if (disconnect) void this.livekit.disconnect(channelId, userId);
  }

  private cancelLeave(userId: string) {
    const timer = this.leaveTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.leaveTimers.delete(userId);
  }

  /**
   * 근접 음성: 참여자마다 다른 참여자들의 음량을 광장 위치로 계산해서, 바뀐 사람에게만 보낸다.
   * 받는 쪽은 0이면 구독을 끊고, 아니면 그 음량으로 튼다.
   */
  private async updateGains(call: Call): Promise<void> {
    if (!call.proximity || call.members.size < 2) return;
    const ids = [...call.members.keys()].sort();
    const positions = await this.plaza.positions(call.plazaId, ids);
    for (const listener of ids) {
      const gains: Record<string, number> = {};
      for (const speaker of ids) {
        if (speaker !== listener) {
          gains[speaker] = proximityGain(positions[listener]!, positions[speaker]!);
        }
      }
      const key = JSON.stringify(gains);
      if (this.sentGains.get(listener) === key) continue;
      this.sentGains.set(listener, key);
      this.realtime.emit(room.user(listener), SocketEvent.VoiceGains, {
        channelId: call.channelId,
        gains,
      });
    }
  }

  private async canSee(userId: string, channelId: string): Promise<boolean> {
    try {
      await this.access.getChannel(userId, channelId);
      return true;
    } catch {
      return false;
    }
  }

  private toDto(call: Call): VoiceCall {
    return {
      channelId: call.channelId,
      proximity: call.proximity,
      members: [...call.members.values()].map(publicMember),
    };
  }
}
