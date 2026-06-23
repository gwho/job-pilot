import PracticeComponent from "./PracticeComponent";

// BUG 1: This is a Next.js App Router page file.
// Try navigating to http://localhost:3000/practice-01 in your browser and see what happens!
export default function PracticePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">Practice Session 1</h1>
      <PracticeComponent />
    </main>
  );
}
