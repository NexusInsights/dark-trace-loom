/** Database failures must never become empty findings or successful writes. */
export async function checkedDatabase<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw result.error;
  return result;
}
