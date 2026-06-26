import type { ReactNode } from 'react';
import type { SatoriOptions } from 'satori';

import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

type RenderToPngOptions = {
  graphemeImages?: Record<string, string>;
  width: number;
  height: number;
  scale?: number;
};

const interFonts = [
  {
    weight: 400,
    data: inter400,
  },
  {
    weight: 500,
    data: inter500,
  },
  {
    weight: 600,
    data: inter600,
  },
  {
    weight: 700,
    data: inter700,
  },
  {
    weight: 800,
    data: inter800,
  },
] satisfies FontDefinition[];

const fonts = interFonts.map(({ data, weight }) => ({
  name: 'Inter',
  data: Buffer.from(data),
  weight,
  style: 'normal' as const,
})) satisfies SatoriOptions['fonts'];

const TWEMOJI_ASSET_BASE_URL = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg';

const transparentEmojiDataUrl = svgToDataUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />',
);

const emojiAssetCache = new Map<string, Promise<string>>();

const loadAdditionalAsset: NonNullable<SatoriOptions['loadAdditionalAsset']> = async (
  languageCode,
  segment,
) => {
  if (languageCode !== 'emoji') {
    return [];
  }

  return getEmojiAsset(segment);
};

export const renderWorldCupAttachmentToPng = async (
  element: ReactNode,
  { graphemeImages, width, height, scale = 2 }: RenderToPngOptions,
) => {
  const svg = await satori(element, {
    width,
    height,
    fonts,
    graphemeImages,
    loadAdditionalAsset,
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

export function loadEmojiImageDataUrl(emoji: string) {
  return getEmojiAsset(emoji);
}

function getEmojiAsset(emoji: string) {
  const cachedAsset = emojiAssetCache.get(emoji);

  if (cachedAsset) {
    return cachedAsset;
  }

  const asset = loadTwemojiSvg(emoji).catch(() => transparentEmojiDataUrl);
  emojiAssetCache.set(emoji, asset);

  return asset;
}

async function loadTwemojiSvg(emoji: string) {
  const codepoints = formatTwemojiCodepoints(emoji);

  if (!codepoints) {
    return transparentEmojiDataUrl;
  }

  const response = await fetch(`${TWEMOJI_ASSET_BASE_URL}/${codepoints}.svg`);

  if (!response.ok) {
    return transparentEmojiDataUrl;
  }

  return svgToDataUrl(await response.text());
}

function formatTwemojiCodepoints(emoji: string) {
  return Array.from(emoji)
    .map((character) => character.codePointAt(0))
    .filter((codepoint): codepoint is number => codepoint !== undefined && codepoint !== 0xfe0f)
    .map((codepoint) => codepoint.toString(16))
    .join('-');
}

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

type FontDefinition = {
  data: Uint8Array;
  weight: NonNullable<SatoriOptions['fonts']>[number]['weight'];
};
