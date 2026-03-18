export interface UserProfile {
  id: string
  username: string
  email: string
  role: "admin" | "user"
  must_change_password?: boolean
}
