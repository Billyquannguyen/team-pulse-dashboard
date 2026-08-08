export type StructuredFormValue = string | number | string[];
export type StructuredFormValues = Record<string, StructuredFormValue>;

export type StructuredFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type StructuredFormField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "multi-select";
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: StructuredFormOption[];
  min?: number;
  max?: number;
  validate?: (value: StructuredFormValue, values: StructuredFormValues) => string | undefined;
};

export function validateStructuredForm(
  fields: StructuredFormField[],
  values: StructuredFormValues,
) {
  const errors: Record<string, string> = {};
  fields.forEach((field) => {
    const value = values[field.key];
    const empty = Array.isArray(value) ? value.length === 0 : String(value ?? "").trim() === "";
    if (field.required && empty) {
      errors[field.key] = `${field.label} is required.`;
      return;
    }
    if (!empty && field.validate) {
      const message = field.validate(value, values);
      if (message) errors[field.key] = message;
    }
  });
  return errors;
}
