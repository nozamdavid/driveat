export function toggleSelectedUri(
  selected: ReadonlySet<string>,
  uri: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(uri)) {
    next.delete(uri);
  } else {
    next.add(uri);
  }
  return next;
}

/**
 * Drops selected URIs that no longer exist so a refresh cannot leave phantom
 * selections. Returns the same Set reference when nothing changed.
 */
export function pruneSelectedUris(
  selected: ReadonlySet<string>,
  availableUris: ReadonlySet<string>,
): ReadonlySet<string> {
  const kept = Array.from(selected).filter((uri) => availableUris.has(uri));
  return kept.length === selected.size ? selected : new Set(kept);
}
