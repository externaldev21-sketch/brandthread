/** Bundled-asset resolution boundary for Node; no native download is attempted. */
export class Asset {
  uri: string;
  localUri: string;
  constructor(source: unknown) {
    this.uri = typeof source === 'string' ? source : `asset:${String(source)}`;
    this.localUri = this.uri;
  }
  static fromModule(source: unknown) { return new Asset(source); }
  static fromURI(source: string) { return new Asset(source); }
  static async loadAsync(sources: unknown | unknown[]) {
    return (Array.isArray(sources) ? sources : [sources]).map(source => new Asset(source));
  }
  async downloadAsync() { return this; }
}
