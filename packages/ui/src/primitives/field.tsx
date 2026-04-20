import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type FieldShellProps = {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  children: ReactNode;
};

function FieldShell({ label, hint, error, htmlFor, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-(--bearhacks-primary)"
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-(--bearhacks-muted)">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-(--bearhacks-danger)">{error}</p> : null}
    </div>
  );
}

const inputClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-primary) focus:outline-none";

type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
};

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  function InputField({ label, hint, error, id, className = "", ...rest }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
        <input
          ref={ref}
          id={inputId}
          className={`${inputClasses} ${className}`}
          {...rest}
        />
      </FieldShell>
    );
  },
);

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
};

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField(
    { label, hint, error, id, className = "", rows = 4, ...rest },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={`min-h-20 resize-y rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 py-2 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-primary) focus:outline-none ${className}`}
          {...rest}
        />
      </FieldShell>
    );
  },
);

export type SelectFieldOption = {
  value: string;
  label: string;
};

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  options: ReadonlyArray<SelectFieldOption>;
  placeholder?: string;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, hint, error, id, className = "", options, placeholder, ...rest },
    ref,
  ) {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    return (
      <FieldShell label={label} hint={hint} error={error} htmlFor={selectId}>
        <select
          ref={ref}
          id={selectId}
          className={`${inputClasses} appearance-none bg-position-[right_0.75rem_center] bg-no-repeat pr-9 ${className}`}
          {...rest}
        >
          {placeholder !== undefined ? (
            <option value="">{placeholder}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  },
);
