import type { ReactNode } from 'react';
import type { SatoriOptions } from 'satori';

import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const emojiAssetCache = new Map<string, Promise<string>>();

const transparentSvgDataUrl =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

const fonts = [
  { data: Buffer.from(inter400), name: 'Inter', weight: 400 },
  { data: Buffer.from(inter500), name: 'Inter', weight: 500 },
  { data: Buffer.from(inter600), name: 'Inter', weight: 600 },
  { data: Buffer.from(inter700), name: 'Inter', weight: 700 },
  { data: Buffer.from(inter800), name: 'Inter', weight: 800 },
] satisfies SatoriOptions['fonts'];

export const renderWorldCupAttachmentToPng = async (
  element: ReactNode,
  { graphemeImages, height, scale = 2, width }: RenderWorldCupAttachmentOptions,
) => {
  const svg = await satori(element, {
    fonts,
    graphemeImages,
    height,
    loadAdditionalAsset,
    width,
  });
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: width * scale,
    },
    imageRendering: 0,
    shapeRendering: 2,
    textRendering: 2,
  });

  return Buffer.from(resvg.render().asPng());
};

export const loadEmojiImageDataUrl = (emoji: string) => getEmojiAsset(emoji);

const loadAdditionalAsset: NonNullable<SatoriOptions['loadAdditionalAsset']> = async (
  _languageCode,
  segment,
) => {
  return getEmojiAsset(segment);
};

const getEmojiAsset = async (emoji: string) => {
  const codepoints = getEmojiCodepoints(emoji);

  if (!codepoints) {
    return transparentSvgDataUrl;
  }

  const cached = emojiAssetCache.get(codepoints);

  if (cached) {
    return cached;
  }

  const asset = fetchTwemojiAsset(codepoints);

  emojiAssetCache.set(codepoints, asset);

  return asset;
};

const fetchTwemojiAsset = async (codepoints: string) => {
  try {
    const response = await fetch(
      `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codepoints}.svg`,
    );

    if (!response.ok) {
      logger.warn(
        { codepoints, status: response.status },
        '[WORLD_CUP]: emoji asset request failed',
      );

      return transparentSvgDataUrl;
    }

    const svg = await response.text();

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch (error) {
    logger.warn(
      { codepoints, safeError: ErrorService.toSafeLog(error) },
      '[WORLD_CUP]: emoji asset unavailable',
    );

    return transparentSvgDataUrl;
  }
};

const getEmojiCodepoints = (emoji: string) => {
  const codepoints = [...emoji]
    .map((segment) => segment.codePointAt(0)?.toString(16))
    .filter((codepoint): codepoint is string => Boolean(codepoint) && codepoint !== 'fe0f');

  return codepoints.length > 0 ? codepoints.join('-') : null;
};

type RenderWorldCupAttachmentOptions = {
  graphemeImages?: Record<string, string>;
  height: number;
  scale?: number;
  width: number;
};
