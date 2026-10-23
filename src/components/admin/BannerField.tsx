import type { StoredImage } from '@/types/domain';
import { BANNER_MAX_EDGE } from '@/utils/image';
import { ImageField } from './ImageField';

export interface BannerFieldProps {
  value: StoredImage | null;
  onChange: (banner: StoredImage | null) => void;
  disabled?: boolean;
}

/**
 * Dashboard banner picker.
 *
 * The same optimiser as the logo and menu photos is used, so the stored image
 * is downscaled and re-encoded before it is saved. Nothing is stored as base64
 * in component state beyond this single value, and no sample image is provided
 * — an unset banner renders the plain themed hero instead.
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
      emptyHint="JPG, PNG or WebP. No banner shows a plain themed header instead."
    />
  );
}
