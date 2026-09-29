import { type LucideProps, Paperclip, createLucideIcon } from 'lucide-react';

/**
 * 앱 아이콘은 lucide(lucide-react)를 쓴다: 한 벌의 선 굵기·모양으로 플랫폼마다 똑같이 보이고, 색은 currentColor라
 * 라이트·다크 모드를 따른다. lucide에 없는 MetaCode 고유의 것(분수 광장)만 같은 규칙(24격자, 2px 선, 둥근 끝)으로
 * 여기서 그린다. 크기는 styles.css의 `.lucide`가 글자 크기에 맞춘다.
 */

/** 분수 광장: 물줄기, 윗접시, 기둥, 아래 수반 */
export const Fountain = createLucideIcon('fountain', [
  ['path', { d: 'M12 2v5', key: 'spout' }],
  ['path', { d: 'M8 8c0-2.2 1.8-4 4-4s4 1.8 4 4', key: 'spray' }],
  ['path', { d: 'M8 10h8', key: 'bowl-rim' }],
  ['path', { d: 'M9 10c0 1.7 1.3 3 3 3s3-1.3 3-3', key: 'bowl' }],
  ['path', { d: 'M12 13v4', key: 'stem' }],
  ['path', { d: 'M4 17h16', key: 'basin-rim' }],
  ['path', { d: 'M5 17c0 2.2 3.1 4 7 4s7-1.8 7-4', key: 'basin' }],
]);

/** 첨부만 있는 메시지를 글자 대신 보여 줄 때: 📎 대신 클립 아이콘 + "파일 N개" */
export function FileCount({ count, ...props }: { count: number } & LucideProps) {
  return (
    <span className="inline-icon">
      <Paperclip aria-hidden {...props} />
      파일 {count}개
    </span>
  );
}
