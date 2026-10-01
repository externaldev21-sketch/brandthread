declare module 'qrcode' {
  interface BitMatrix {
    size: number;
    get(row: number, col: number): number;
  }
  const QRCode: {
    create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: BitMatrix };
  };
  export default QRCode;
}
