function isDpopNonceChallenge(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /use_dpop_(?:nonce|once)/i.test(message);
}

/**
 * Retries once after an OAuth SDK call receives the authorization server's
 * initial DPoP nonce. The SDK caches the nonce before surfacing the error, so
 * the second call can create a nonce-bound proof.
 */
export async function retryDpopNonceChallenge<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!isDpopNonceChallenge(error)) throw error;
    return operation();
  }
}
