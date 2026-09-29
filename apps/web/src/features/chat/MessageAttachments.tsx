import type { AttachmentDto } from '@metacode/shared';
import { useEffect, useState } from 'react';
import { attachmentUrl, downloadAttachment, formatBytes } from './uploads';
import { Download, File as FileIcon } from 'lucide-react';

/** 채팅에 보이는 이미지의 최대 크기 (썸네일은 480px로 만들어 두었다) */
const IMAGE_BOX = { width: 320, height: 240 };
/**
 * 이 크기 이하의 GIF는 목록에서 원본을 바로 틀어 움직이게 한다 (썸네일은 첫 장면만 담긴 WebP라 멈춰 있음).
 * 더 크면 썸네일에 GIF 표시만 하고, 누르면 크게 보기에서 움직인다.
 */
export const GIF_INLINE_MAX_BYTES = 15 * 1024 * 1024;

/** 목록에서 원본을 바로 보여 줄 움직이는 이미지인지 */
export function playsInline(image: Pick<AttachmentDto, 'contentType' | 'size'>): boolean {
  return image.contentType === 'image/gif' && image.size <= GIF_INLINE_MAX_BYTES;
}

function fitInBox(width: number | null, height: number | null) {
  if (!width || !height) return IMAGE_BOX;
  const scale = Math.min(1, IMAGE_BOX.width / width, IMAGE_BOX.height / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** 메시지에 붙은 첨부: 이미지는 썸네일, 나머지는 파일 카드 */
export function MessageAttachments({ attachments }: { attachments: AttachmentDto[] }) {
  const [viewing, setViewing] = useState<AttachmentDto | null>(null);
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === 'image');
  const files = attachments.filter((a) => a.kind === 'file');

  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className="attachments__images">
          {images.map((image) => {
            // 원본 비율로 자리를 먼저 잡아, 이미지가 늦게 떠도 목록이 밀리지 않게 한다.
            const size = fitInBox(image.width, image.height);
            const gif = image.contentType === 'image/gif';
            const animated = playsInline(image);
            return (
              <button
                key={image.id}
                className="attachments__image"
                onClick={() => setViewing(image)}
                title={image.fileName}
                style={size}
              >
                {gif && !animated && <span className="attachments__badge">GIF</span>}
                <img
                  src={
                    animated
                      ? attachmentUrl(image.id)
                      : attachmentUrl(image.id, { variant: 'thumbnail' })
                  }
                  alt={image.fileName}
                  width={size.width}
                  height={size.height}
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>
      )}
      {files.map((file) => (
        <div key={file.id} className="file-card">
          <span className="file-card__icon" aria-hidden>
            <FileIcon />
          </span>
          <span className="file-card__info">
            <span className="file-card__name">{file.fileName}</span>
            <span className="file-card__size">{formatBytes(file.size)}</span>
          </span>
          <button
            className="icon-button"
            onClick={() => downloadAttachment(file)}
            aria-label={`${file.fileName} 내려받기`}
            title="내려받기"
          >
            <Download aria-hidden />
          </button>
        </div>
      ))}
      {viewing && <Lightbox image={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** 이미지를 크게 보기. Esc나 바깥을 누르면 닫힌다. */
function Lightbox({ image, onClose }: { image: AttachmentDto; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.fileName}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <img src={attachmentUrl(image.id)} alt={image.fileName} />
      <div className="lightbox__bar">
        <span>
          {image.fileName} · {formatBytes(image.size)}
          {image.width && image.height ? ` · ${image.width}×${image.height}` : ''}
        </span>
        <button className="button" onClick={() => downloadAttachment(image)}>
          원본 내려받기
        </button>
        <button className="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
