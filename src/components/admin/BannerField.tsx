import type { StoredImage } from '@/types/domain';
import { BANNER_MAX_EDGE } from '@/utils/image';
import defaultBannerUrl from '@/assets/default-restaurant-banner.jpg';
import { ImageField } from './ImageField';

export interface BannerFieldProps {
  value: StoredImage | null;
  onChange: (banner: StoredImage | null) => void;
  disabled?: boolean;
}

/**
 * Dashboard banner picker (Settings only — the dashboard itself carries no
 * editing controls).
 *
 * The same optimiser as the logo and menu photos is used, so the stored image
 * is downscaled and re-encoded before it is saved. With no custom banner the
 * preview shows the built-in restaurant banner bundled with the app, which
 * is what the dashboard displays; clearing a custom banner therefore reads
 * as "Restore default", not "remove the banner".
 */
export function BannerField({ value, onChange, disabled }: BannerFieldProps) {
  return (
    <ImageField
      value={value}
      onChange={onChange}
      disabled={disabled}
      label="Dashboard banner"
      idPrefix="banner"
      maxEdge={BANNER_MAX_EDGE}
      aspect={16 / 5}
      uploadLabel="Upload banner image"
      emptyHint="JPG, PNG or WebP. The built-in restaurant banner is shown until you upload your own."
      fallbackSrc={defaultBannerUrl}
      fallbackNote="Built-in restaurant banner in use. Upload an image to replace it; your choice is kept after saving."
      removeLabel="Restore default"
    />
  );
}
