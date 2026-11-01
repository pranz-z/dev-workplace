/**
 * PostgREST caps a single response (1000 rows by default) without raising an
 * error, so unpaged list reads silently drop everything past the cap. Callers
 * pass an ordered query that ends in a unique tie-breaker so pages never overlap.
 */
export const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
