import { signOut } from "@/app/actions/auth";
import { SignOutPostHogResetButton } from "@/components/layout/SignOutPostHogResetButton";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <SignOutPostHogResetButton />
    </form>
  );
}
