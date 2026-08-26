export function createOAuthInitializer<Result>(
  initialize: () => Promise<Result>,
): () => Promise<Result> {
  let initialization: Promise<Result> | undefined;

  return () => {
    initialization ??= initialize().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });

    return initialization;
  };
}
