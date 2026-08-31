//! Skyline data structure for collision detection.
//!
//! A skyline is a sequence of non-overlapping rectangular "buildings" that
//! represent a height profile. Two facing skylines (UP and DOWN) can measure
//! the gap between them for collision avoidance.

/// Direction a skyline faces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkylineDirection {
    /// Heights extend upward (positive Y is up). Used for elements above the staff.
    Up,
    /// Heights extend downward (positive Y is down). Used for elements below the staff.
    Down,
}

/// A single rectangular region in a skyline.
#[derive(Debug, Clone, Copy)]
pub struct Building {
    pub x_start: f64,
    pub x_end: f64,
    /// Height of this building. For an Up skyline, larger = higher.
    /// For a Down skyline, larger = lower.
    pub height: f64,
}

/// A skyline: a sequence of non-overlapping, x-sorted rectangular buildings
/// representing a height envelope.
#[derive(Debug, Clone)]
pub struct Skyline {
    pub direction: SkylineDirection,
    pub buildings: Vec<Building>,
}

impl Skyline {
    /// Create an empty skyline.
    pub fn new(direction: SkylineDirection) -> Self {
        Self {
            direction,
            buildings: Vec::new(),
        }
    }

    /// Create a skyline from a list of buildings, merging overlaps.
    pub fn from_buildings(direction: SkylineDirection, buildings: Vec<Building>) -> Self {
        let mut skyline = Self::new(direction);
        for b in buildings {
            skyline.add_building(b.x_start, b.x_end, b.height);
        }
        skyline
    }

    /// Add a rectangular building to this skyline, merging with existing buildings.
    /// The new building's height wins where it exceeds the current envelope.
    pub fn add_building(&mut self, x_start: f64, x_end: f64, height: f64) {
        if x_start >= x_end {
            return;
        }
        let new_b = Building {
            x_start,
            x_end,
            height,
        };
        let other = Skyline {
            direction: self.direction,
            buildings: vec![new_b],
        };
        *self = self.merge(&other);
    }

    /// Merge two skylines of the same direction, keeping the max (Up) or min (Down)
    /// height at every X position. O(n + m) sweep algorithm.
    pub fn merge(&self, other: &Skyline) -> Skyline {
        debug_assert_eq!(self.direction, other.direction);

        // Collect all X breakpoints
        let mut xs: Vec<f64> = Vec::new();
        for b in &self.buildings {
            xs.push(b.x_start);
            xs.push(b.x_end);
        }
        for b in &other.buildings {
            xs.push(b.x_start);
            xs.push(b.x_end);
        }
        xs.sort_by(|a, b| a.total_cmp(b));
        xs.dedup_by(|a, b| (*a - *b).abs() < 1e-10);

        let mut result_buildings: Vec<Building> = Vec::new();

        for i in 0..xs.len().saturating_sub(1) {
            let x0 = xs[i];
            let x1 = xs[i + 1];
            if (x1 - x0).abs() < 1e-10 {
                continue;
            }
            let mid = (x0 + x1) * 0.5;
            let h_self = self.height_at(mid);
            let h_other = other.height_at(mid);

            let h = match self.direction {
                SkylineDirection::Up => match (h_self, h_other) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (Some(a), None) => Some(a),
                    (None, Some(b)) => Some(b),
                    (None, None) => None,
                },
                SkylineDirection::Down => match (h_self, h_other) {
                    (Some(a), Some(b)) => Some(a.min(b)),
                    (Some(a), None) => Some(a),
                    (None, Some(b)) => Some(b),
                    (None, None) => None,
                },
            };

            if let Some(height) = h {
                // Try to extend the last building if same height
                if let Some(last) = result_buildings.last_mut() {
                    if (last.height - height).abs() < 1e-10 && (last.x_end - x0).abs() < 1e-10 {
                        last.x_end = x1;
                        continue;
                    }
                }
                result_buildings.push(Building {
                    x_start: x0,
                    x_end: x1,
                    height,
                });
            }
        }

        Skyline {
            direction: self.direction,
            buildings: result_buildings,
        }
    }

    /// Query the height at a specific X position. Returns None if no building covers it.
    pub fn height_at(&self, x: f64) -> Option<f64> {
        for b in &self.buildings {
            if x >= b.x_start - 1e-10 && x <= b.x_end + 1e-10 {
                return Some(b.height);
            }
        }
        None
    }

    /// Maximum height within a given X range. Returns None if no building
    /// overlaps the range.
    pub fn max_height_in_range(&self, x_start: f64, x_end: f64) -> Option<f64> {
        let mut max_h: Option<f64> = None;
        for b in &self.buildings {
            // Check overlap: building overlaps [x_start, x_end] if
            // b.x_start < x_end && b.x_end > x_start
            if b.x_start < x_end + 1e-10 && b.x_end > x_start - 1e-10 {
                max_h = Some(match max_h {
                    Some(h) => h.max(b.height),
                    None => b.height,
                });
            }
        }
        max_h
    }

    /// Minimum height within a given X range. Returns None if no building
    /// overlaps the range.
    pub fn min_height_in_range(&self, x_start: f64, x_end: f64) -> Option<f64> {
        let mut min_h: Option<f64> = None;
        for b in &self.buildings {
            if b.x_start < x_end + 1e-10 && b.x_end > x_start - 1e-10 {
                min_h = Some(match min_h {
                    Some(h) => h.min(b.height),
                    None => b.height,
                });
            }
        }
        min_h
    }

    /// Compute the minimum distance between this skyline (Up) and another (Down).
    ///
    /// For an Up skyline facing a Down skyline, the distance at each X is:
    ///   down_height - up_height
    /// The minimum across all overlapping X ranges gives the closest approach.
    ///
    /// Returns None if the skylines don't overlap in X.
    pub fn distance(&self, other: &Skyline) -> Option<f64> {
        debug_assert_eq!(self.direction, SkylineDirection::Up);
        debug_assert_eq!(other.direction, SkylineDirection::Down);

        // Collect all X breakpoints from both skylines
        let mut xs: Vec<f64> = Vec::new();
        for b in &self.buildings {
            xs.push(b.x_start);
            xs.push(b.x_end);
        }
        for b in &other.buildings {
            xs.push(b.x_start);
            xs.push(b.x_end);
        }
        xs.sort_by(|a, b| a.total_cmp(b));
        xs.dedup_by(|a, b| (*a - *b).abs() < 1e-10);

        let mut min_dist: Option<f64> = None;
        for i in 0..xs.len().saturating_sub(1) {
            let x0 = xs[i];
            let x1 = xs[i + 1];
            if (x1 - x0).abs() < 1e-10 {
                continue;
            }
            let mid = (x0 + x1) * 0.5;
            let h_up = self.height_at(mid);
            let h_down = other.height_at(mid);
            if let (Some(hu), Some(hd)) = (h_up, h_down) {
                let d = hd - hu;
                min_dist = Some(match min_dist {
                    Some(prev) => prev.min(d),
                    None => d,
                });
            }
        }
        min_dist
    }

    /// Return the rightmost x_end of all buildings, or 0.0 if empty.
    pub fn right_edge(&self) -> f64 {
        self.buildings
            .iter()
            .map(|b| b.x_end)
            .fold(0.0_f64, f64::max)
    }

    /// Return the leftmost x_start of all buildings, or 0.0 if empty.
    pub fn left_edge(&self) -> f64 {
        self.buildings
            .iter()
            .map(|b| b.x_start)
            .fold(f64::INFINITY, f64::min)
    }

    /// Returns true if the skyline has no buildings.
    pub fn is_empty(&self) -> bool {
        self.buildings.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_skyline() {
        let s = Skyline::new(SkylineDirection::Up);
        assert!(s.is_empty());
        assert_eq!(s.height_at(0.0), None);
        assert_eq!(s.max_height_in_range(0.0, 10.0), None);
    }

    #[test]
    fn test_single_building() {
        let mut s = Skyline::new(SkylineDirection::Up);
        s.add_building(0.0, 10.0, 5.0);
        assert_eq!(s.buildings.len(), 1);
        assert_eq!(s.height_at(5.0), Some(5.0));
        assert_eq!(s.height_at(15.0), None);
        assert_eq!(s.max_height_in_range(3.0, 7.0), Some(5.0));
    }

    #[test]
    fn test_merge_non_overlapping() {
        let a = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 5.0,
                height: 3.0,
            }],
        };
        let b = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 7.0,
                x_end: 12.0,
                height: 4.0,
            }],
        };
        let merged = a.merge(&b);
        assert_eq!(merged.buildings.len(), 2);
        assert_eq!(merged.height_at(3.0), Some(3.0));
        assert_eq!(merged.height_at(6.0), None);
        assert_eq!(merged.height_at(9.0), Some(4.0));
    }

    #[test]
    fn test_merge_overlapping_up() {
        // Two overlapping buildings: [0,10)@3 and [5,15)@5
        // Result: [0,5)@3, [5,10)@5, [10,15)@5
        let a = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 3.0,
            }],
        };
        let b = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 5.0,
                x_end: 15.0,
                height: 5.0,
            }],
        };
        let merged = a.merge(&b);
        // At x=3, height should be 3
        assert_eq!(merged.height_at(3.0), Some(3.0));
        // At x=7, height should be 5 (max of 3, 5)
        assert_eq!(merged.height_at(7.0), Some(5.0));
        // At x=12, height should be 5
        assert_eq!(merged.height_at(12.0), Some(5.0));
    }

    #[test]
    fn test_merge_overlapping_down() {
        // Down skylines keep min
        let a = Skyline {
            direction: SkylineDirection::Down,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 3.0,
            }],
        };
        let b = Skyline {
            direction: SkylineDirection::Down,
            buildings: vec![Building {
                x_start: 5.0,
                x_end: 15.0,
                height: 1.0,
            }],
        };
        let merged = a.merge(&b);
        assert_eq!(merged.height_at(3.0), Some(3.0));
        // At x=7, min(3, 1) = 1
        assert_eq!(merged.height_at(7.0), Some(1.0));
        assert_eq!(merged.height_at(12.0), Some(1.0));
    }

    #[test]
    fn test_merge_contained() {
        // Smaller building fully inside larger
        let a = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 20.0,
                height: 2.0,
            }],
        };
        let b = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 5.0,
                x_end: 10.0,
                height: 8.0,
            }],
        };
        let merged = a.merge(&b);
        assert_eq!(merged.height_at(3.0), Some(2.0));
        assert_eq!(merged.height_at(7.0), Some(8.0));
        assert_eq!(merged.height_at(15.0), Some(2.0));
    }

    #[test]
    fn test_distance_basic() {
        // Up skyline at height 3, Down skyline at height 10
        // Distance = 10 - 3 = 7
        let up = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 3.0,
            }],
        };
        let down = Skyline {
            direction: SkylineDirection::Down,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 10.0,
            }],
        };
        let d = up.distance(&down);
        assert!((d.unwrap() - 7.0).abs() < 1e-10);
    }

    #[test]
    fn test_distance_partial_overlap() {
        let up = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![
                Building {
                    x_start: 0.0,
                    x_end: 5.0,
                    height: 2.0,
                },
                Building {
                    x_start: 5.0,
                    x_end: 10.0,
                    height: 8.0,
                },
            ],
        };
        let down = Skyline {
            direction: SkylineDirection::Down,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 9.0,
            }],
        };
        // Distance at [0,5): 9-2=7, at [5,10): 9-8=1 → min = 1
        let d = up.distance(&down);
        assert!((d.unwrap() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_distance_no_overlap() {
        let up = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 5.0,
                height: 3.0,
            }],
        };
        let down = Skyline {
            direction: SkylineDirection::Down,
            buildings: vec![Building {
                x_start: 10.0,
                x_end: 15.0,
                height: 10.0,
            }],
        };
        assert_eq!(up.distance(&down), None);
    }

    #[test]
    fn test_distance_negative_collision() {
        // Up skyline extends above the down skyline → negative distance = collision
        let up = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 12.0,
            }],
        };
        let down = Skyline {
            direction: SkylineDirection::Down,
            buildings: vec![Building {
                x_start: 0.0,
                x_end: 10.0,
                height: 8.0,
            }],
        };
        let d = up.distance(&down);
        assert!(d.unwrap() < 0.0); // 8 - 12 = -4
        assert!((d.unwrap() - (-4.0)).abs() < 1e-10);
    }

    #[test]
    fn test_add_building_sequential() {
        let mut s = Skyline::new(SkylineDirection::Up);
        s.add_building(0.0, 5.0, 3.0);
        s.add_building(5.0, 10.0, 3.0);
        // Adjacent same-height buildings should merge into one
        assert_eq!(s.buildings.len(), 1);
        assert!((s.buildings[0].x_end - 10.0).abs() < 1e-10);
    }

    #[test]
    fn test_max_height_in_range() {
        let s = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![
                Building {
                    x_start: 0.0,
                    x_end: 5.0,
                    height: 3.0,
                },
                Building {
                    x_start: 5.0,
                    x_end: 10.0,
                    height: 7.0,
                },
                Building {
                    x_start: 10.0,
                    x_end: 15.0,
                    height: 2.0,
                },
            ],
        };
        assert_eq!(s.max_height_in_range(0.0, 15.0), Some(7.0));
        assert_eq!(s.max_height_in_range(0.0, 4.0), Some(3.0));
        assert_eq!(s.max_height_in_range(6.0, 9.0), Some(7.0));
        assert_eq!(s.max_height_in_range(20.0, 30.0), None);
    }

    #[test]
    fn test_from_buildings() {
        let s = Skyline::from_buildings(
            SkylineDirection::Up,
            vec![
                Building {
                    x_start: 0.0,
                    x_end: 10.0,
                    height: 3.0,
                },
                Building {
                    x_start: 5.0,
                    x_end: 15.0,
                    height: 5.0,
                },
            ],
        );
        assert_eq!(s.height_at(3.0), Some(3.0));
        assert_eq!(s.height_at(7.0), Some(5.0));
    }

    #[test]
    fn test_right_left_edge() {
        let s = Skyline {
            direction: SkylineDirection::Up,
            buildings: vec![
                Building {
                    x_start: 2.0,
                    x_end: 5.0,
                    height: 1.0,
                },
                Building {
                    x_start: 8.0,
                    x_end: 12.0,
                    height: 2.0,
                },
            ],
        };
        assert!((s.left_edge() - 2.0).abs() < 1e-10);
        assert!((s.right_edge() - 12.0).abs() < 1e-10);
    }

    #[test]
    fn test_merge_multiple_buildings() {
        // Three buildings with various overlaps
        let mut s = Skyline::new(SkylineDirection::Up);
        s.add_building(0.0, 10.0, 2.0);
        s.add_building(3.0, 7.0, 5.0);
        s.add_building(6.0, 12.0, 3.0);
        // Expected profile: [0,3)@2, [3,7)@5, [7,10)@3, [10,12)@3
        assert_eq!(s.height_at(1.0), Some(2.0));
        assert_eq!(s.height_at(5.0), Some(5.0));
        assert_eq!(s.height_at(8.0), Some(3.0));
        assert_eq!(s.height_at(11.0), Some(3.0));
    }
}
