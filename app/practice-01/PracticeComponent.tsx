// BUG 2: This is a regular UI component. 
// We want to follow the project's strict convention for exporting these.
export default function PracticeComponent() {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p>I am a practice component. Can you fix my export?</p>
    </div>
  );
}
