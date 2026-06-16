import { SignOutButton } from "@/components/layout/SignOutButton";

type Props = {
  title: string;
  description: string;
};

export function ComingSoonCard({ title, description }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-lg max-w-sm w-full">
      <h1 className="text-base font-semibold text-text-primary mb-1">{title}</h1>
      <p className="text-sm text-text-muted mb-6">{description}</p>
      <SignOutButton />
    </div>
  );
}
