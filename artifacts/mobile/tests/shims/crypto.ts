import { createHash, randomUUID as nodeRandomUUID, randomBytes } from 'node:crypto';
export const randomUUID = nodeRandomUUID;
export const CryptoDigestAlgorithm = { SHA256: 'SHA256', SHA512: 'SHA512', SHA1: 'SHA1' };
export const digestStringAsync = async (algorithm: string, input: string) => createHash(algorithm.toLowerCase()).update(input).digest('hex');
export const getRandomBytesAsync = async (count: number) => new Uint8Array(randomBytes(count));
