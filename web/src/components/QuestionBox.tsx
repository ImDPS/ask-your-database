import type { FormEvent, KeyboardEvent } from 'react'

export const MAX_QUESTION_CHARS = 300

interface Props {
  value: string
  loading: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}

export default function QuestionBox({ value, loading, onChange, onSubmit }: Props) {
  const canAsk = !loading && value.trim().length > 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (canAsk) onSubmit()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canAsk) onSubmit()
    }
  }

  return (
    <form onSubmit={submit} className="question">
      <label htmlFor="question">Your question</label>
      <textarea
        id="question"
        rows={3}
        maxLength={MAX_QUESTION_CHARS}
        value={value}
        placeholder="For example: Which genre sells best?"
        aria-describedby="question-count question-notice"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="question-foot">
        <span id="question-count" className="muted">{value.length} / {MAX_QUESTION_CHARS}</span>
        <button type="submit" disabled={!canAsk}>Ask</button>
      </div>
      <p id="question-notice" className="notice">
        Questions are sent to Google's free Gemini service and may be reviewed by people. Please do not enter personal information.
      </p>
    </form>
  )
}
