// Focused types for the menu spine (hand-written for the first screen).
// Will be replaced by `supabase gen types typescript` once the full app grows.
export type MenuItem = {
  id: string;
  restaurant_id: string | null;
  recipe_id: string | null;
  name: string;
  section: string | null;
  price: number | null;
  cost: number | null;
  description: string | null;
  is_active: boolean | null;
  is_eighty_six: boolean | null;
  is_special: boolean | null;
  beverage_type: string | null;
};
