import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * S3 호환 파일 저장소(로컬/운영 모두 SeaweedFS).
 * - 서버가 직접 읽고 쓸 때는 내부 주소(S3_ENDPOINT)를 쓴다.
 * - 브라우저에 줄 presigned URL은 공개 주소(S3_PUBLIC_ENDPOINT)로 서명한다. 서명에 호스트가 들어가므로
 *   내부 주소로 서명하면 브라우저에서 쓸 수 없다.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly signer: S3Client;
  readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    const common = {
      region: config.get('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY'),
        secretAccessKey: config.get('S3_SECRET_KEY'),
      },
      // 기본값(WHEN_SUPPORTED)은 presigned URL에 빈 본문의 체크섬을 넣어 실제 업로드가 BadDigest로 실패한다.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;
    const endpoint = config.get('S3_ENDPOINT');
    this.client = new S3Client({ ...common, endpoint });
    this.signer = new S3Client({
      ...common,
      endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? endpoint,
    });
    this.bucket = config.get('S3_BUCKET');
  }

  /** 정확히 size 바이트만 올릴 수 있는 PUT 주소. 크기와 형식이 서명에 들어가 다르면 저장소가 거절한다. */
  presignPut(key: string, size: number, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: 'application/octet-stream',
        ContentLength: size,
      }),
      { expiresIn, signableHeaders: new Set(['content-length', 'content-type']) },
    );
  }

  presignGet(
    key: string,
    options: { contentType: string; disposition: string },
    expiresIn: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: options.disposition,
      }),
      { expiresIn },
    );
  }

  /** 없으면 null */
  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound')
        return null;
      throw error;
    }
  }

  /** 앞부분만 읽는다 (형식 판별용). */
  async readHead(key: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** 여러 파일을 지운다. 실패해도 예외를 던지지 않고 기록만 한다 (정리 작업에서 다시 시도된다). */
  async remove(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      try {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch (error) {
        this.logger.warn(`파일 ${batch.length}개 삭제 실패: ${(error as Error).message}`);
      }
    }
  }
}
