// Focused types for the menu spine.
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
  category: string | null;
  course: string | null;
  wine_style: string | null;
};
