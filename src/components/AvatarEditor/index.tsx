import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { Popup, Button, Toast } from 'antd-mobile';
import { Camera, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Area } from 'react-easy-crop';
import { uploadErrorMessage } from '../../utils/uploadError';
import styles from './index.module.css';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<string>;
}

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', (error) => reject(error));
    img.src = url;
  });

const getCroppedImg = async (imageSrc: string, crop: Area): Promise<Blob> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const size = Math.max(crop.width, crop.height);
  canvas.width = size;
  canvas.height = size;

  // 输出方形原图，圆角由展示层统一裁剪（避免保存成圆形后在圆角方形里露白角）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size,
    size
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9);
  });
};

const AvatarEditor = ({ visible, onClose, onUpload }: Props) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<'select' | 'crop'>('select');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setStep('crop');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleSave = async () => {
    if (!croppedArea || !imageSrc) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(imageSrc, croppedArea);
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      await onUpload(file);
      Toast.show({ content: t('common.success') });
      handleClose();
    } catch (e) {
      Toast.show({ content: uploadErrorMessage(e, 'common.error') });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setStep('select');
    setImageSrc('');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    onClose();
  };

  return (
    <Popup
      visible={visible}
      onMaskClick={handleClose}
      bodyStyle={{ height: step === 'crop' ? '100vh' : 'auto', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
    >
      {step === 'select' && (
        <div className={styles.sourceSelect}>
          <div className={styles.sourceTitle}>{t('profile.changeAvatar')}</div>
          <label className={styles.sourceBtn}>
            <input
              type="file"
              accept="image/*"
              capture="user"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <span className={styles.sourceIcon}><Camera size={22} strokeWidth={1.8} /></span>
            <span>{t('profile.takePhoto')}</span>
          </label>
          <label className={styles.sourceBtn}>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <span className={styles.sourceIcon}><ImageIcon size={22} strokeWidth={1.8} /></span>
            <span>{t('profile.fromGallery')}</span>
          </label>
          <Button block className={styles.cancelBtn} onClick={handleClose}>
            {t('common.cancel')}
          </Button>
        </div>
      )}

      {step === 'crop' && (
        <div className={styles.cropContainer}>
          <div className={styles.cropHeader}>
            <Button onClick={() => setStep('select')} className={styles.cropBack}>
              {t('common.back')}
            </Button>
            <span className={styles.cropTitle}>{t('profile.adjustAvatar')}</span>
            <Button
              color="primary"
              loading={saving}
              onClick={handleSave}
              className={styles.cropSave}
            >
              {t('common.save')}
            </Button>
          </div>
          <div className={styles.cropperWrapper}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className={styles.zoomRow}>
            <span>-</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className={styles.zoomSlider}
            />
            <span>+</span>
          </div>
        </div>
      )}
    </Popup>
  );
};

export default AvatarEditor;
