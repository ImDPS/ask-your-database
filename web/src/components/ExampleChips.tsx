import type { ExampleItem } from '../api'

interface Props {
  examples: ExampleItem[]
  disabled: boolean
  onRun: (id: number) => void
}

export default function ExampleChips({ examples, disabled, onRun }: Props) {
  if (examples.length === 0) return null
  return (
    <div className="chips" role="group" aria-label="Example questions">
      {examples.map((ex) => (
        <button key={ex.id} type="button" className="chip" disabled={disabled} onClick={() => onRun(ex.id)}>
          <span>{ex.question}</span>
          <small className="chip-note">no AI call</small>
        </button>
      ))}
    </div>
  )
}
