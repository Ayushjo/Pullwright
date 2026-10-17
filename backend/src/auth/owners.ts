/** GitHub logins listed in OPERATOR_GITHUB_LOGINS: the product's owners (see every task, the free-pool page). */
export function isOwnerLogin(login: string | undefined | null): boolean {
  if (!login) return false
  const owners = (process.env.OPERATOR_GITHUB_LOGINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
  return owners.includes(login.toLowerCase())
}
