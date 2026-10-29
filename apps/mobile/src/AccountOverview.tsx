import type { User } from "@groundops/contracts";
import type { AccountActivity } from "./liveActivity";

export function AccountOverview(_props: {
  accountView: {
    user: User;
    live: "authenticated" | "closed";
    activity: AccountActivity;
  };
}) {
  return null;
}
