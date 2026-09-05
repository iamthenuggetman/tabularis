use super::map_color_scheme;

#[test]
fn maps_no_preference_to_light() {
    assert_eq!(map_color_scheme(0), "light");
}

#[test]
fn maps_dark_to_dark() {
    assert_eq!(map_color_scheme(1), "dark");
}

#[test]
fn maps_light_to_light() {
    assert_eq!(map_color_scheme(2), "light");
}

#[test]
fn maps_unknown_values_to_light() {
    assert_eq!(map_color_scheme(3), "light");
    assert_eq!(map_color_scheme(u32::MAX), "light");
}
