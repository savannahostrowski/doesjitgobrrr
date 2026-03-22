import { createSignal, Show, type Component, type Setter } from "solid-js";
import { GOAL_LINE_MAX, GOAL_LINE_MIN, isValidGoalValue, type GoalLines } from "../types";

interface CustomGoalInputProps {
    goalLines: GoalLines;
    onGoalLinesChange: Setter<GoalLines>;
    disabled?: boolean;
    color: string;
}

const CustomGoalInput: Component<CustomGoalInputProps> = (props) => {
    const [error, setError] = createSignal<string | null>(null);

    return (
    <div class={`custom-goal-input ${props.goalLines.custom !== null ? 'has-value' : ''} ${error() ? 'has-error' : ''}`}>
      <span class="goal-line-indicator" style={{ background: props.color }} />
      <input
        type="number"
        min={GOAL_LINE_MIN}
        max={GOAL_LINE_MAX}
        step="1"
        placeholder="Custom %"
        value={props.goalLines.custom !== null ? `${props.goalLines.custom}` : ''}
        onKeyDown={(e) => {
          if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault();
        }}
        onInput={(e) => {
          const val = e.currentTarget.value;
          if (val === '') {
            setError(null);
            props.onGoalLinesChange(prev => ({ ...prev, custom: null }));
          } else {
            const num = parseInt(val, 10);
            if (isValidGoalValue(num)) {
              setError(null);
              props.onGoalLinesChange(prev => ({ ...prev, custom: num }));
            } else {
              setError(`${GOAL_LINE_MIN}-${GOAL_LINE_MAX} only`);
            }
          }
        }}
        onBlur={() => setError(null)}
        disabled={props.disabled}
        title={`Custom goal line (${GOAL_LINE_MIN}-${GOAL_LINE_MAX}%)`}
      />
      <Show when={error()}>
        <span class="custom-goal-error">{error()}</span>
      </Show>
      <Show when={!error() && props.goalLines.custom !== null}>
        <button
          type="button"
          class="custom-goal-clear"
          onClick={() => props.onGoalLinesChange(prev => ({ ...prev, custom: null }))}
          title="Clear"
        >
          ×
        </button>
      </Show>
    </div>
  );
};

export default CustomGoalInput;