import Image from "next/image";

export function Testimonial() {
  return (
    <section className="bg-background py-24">
      <div className="max-w-2xl mx-auto px-8 flex flex-col items-center text-center gap-8">
        <blockquote className="text-2xl font-medium text-text-primary leading-relaxed">
          &ldquo;I used to spend my evenings copy-pasting resumes. Now I open
          my dashboard to see interviews waiting. It feels like cheating. Had 3
          offers on the table simultaneously.&rdquo;
        </blockquote>

        <div className="flex flex-col items-center gap-3">
          <Image
            src="/images/user-icon.png"
            alt="Alex Rivera"
            width={48}
            height={48}
            className="rounded-full"
          />
          <div>
            <p className="text-sm font-medium text-text-primary">Alex Rivera</p>
            <p className="text-sm text-text-muted">Senior Frontend Engineer</p>
          </div>
        </div>
      </div>
    </section>
  );
}
