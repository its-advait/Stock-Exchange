import { Algorithm, hash, verify } from '@node-rs/argon2';

export interface PasswordParams {
  memoryCost: number;
  timeCost: number;
}

let params: PasswordParams = { memoryCost: 19456, timeCost: 2 };

export function configurePasswordHashing(p: PasswordParams): void {
  params = p;
}

/** argon2id (OWASP baseline: m=19 MiB, t=2, p=1 by default). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: 1,
  });
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Equalize login timing for unknown usernames. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('aez-dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
