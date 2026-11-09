import { t } from '../i18n/i18n'

const SQUARE_SIZE = 256
const SOCIAL_WIDTH = 1200
const SOCIAL_HEIGHT = 630

/**
 * `file` cropped to its centered square and shrunk to SQUARE_SIZE, as WebP
 * (PNG where the browser can't encode WebP). Rejects if it isn't an image
 * the browser can read.
 */
export async function squareImage(file: Blob, size = SQUARE_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(size, side)
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t('errors.unreadableImage'))
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('errors.unreadableImage')))),
      'image/webp',
      0.9,
    ),
  )
}

/**
 * `file` cropped around its center to 1200 x 630, the size link previews use,
 * as JPEG on white. Rejects if it isn't an image the browser can read.
 */
export async function socialImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.max(SOCIAL_WIDTH / bitmap.width, SOCIAL_HEIGHT / bitmap.height)
  const width = SOCIAL_WIDTH / scale
  const height = SOCIAL_HEIGHT / scale
  const canvas = document.createElement('canvas')
  canvas.width = SOCIAL_WIDTH
  canvas.height = SOCIAL_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t('errors.unreadableImage'))
  context.fillStyle = '#fff'
  context.fillRect(0, 0, SOCIAL_WIDTH, SOCIAL_HEIGHT)
  context.drawImage(
    bitmap,
    (bitmap.width - width) / 2,
    (bitmap.height - height) / 2,
    width,
    height,
    0,
    0,
    SOCIAL_WIDTH,
    SOCIAL_HEIGHT,
  )
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('errors.unreadableImage')))),
      'image/jpeg',
      0.9,
    ),
  )
}
