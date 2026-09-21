// Shared by the public apply page and its API route.
export const APPLY_CONTACT: Record<string, string> = {
  bm: "info@bistro-mondo.com",
  taller: "info@ibzfoodstudio.com",
};

export type ApplyAnswers = {
  right_to_work: "yes" | "no" | "in_progress" | "";
  start_date: string;
  notice: string;
  salary: string;
  weekends: "yes" | "no" | "some" | "";
  lives_where: string;
  transport: string;
  references: string;
  station: string;
  allergen_training: "yes" | "no" | "";
  note: string;
};

export const EMPTY_ANSWERS: ApplyAnswers = {
  right_to_work: "",
  start_date: "",
  notice: "",
  salary: "",
  weekends: "",
  lives_where: "",
  transport: "",
  references: "",
  station: "",
  allergen_training: "",
  note: "",
};
