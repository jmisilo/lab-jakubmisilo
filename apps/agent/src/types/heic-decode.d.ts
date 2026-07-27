declare module 'heic-decode' {
  type DecodedHeicImage = {
    data: Uint8ClampedArray;
    height: number;
    width: number;
  };

  function decodeHeic(input: { buffer: Buffer }): Promise<DecodedHeicImage>;

  export default decodeHeic;
}
