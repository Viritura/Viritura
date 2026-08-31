//! Score data model — Rust types representing MNX music notation.
//!
//! These types can be deserialized directly from MNX JSON via serde.
//! They mirror the W3C MNX specification structure.

pub mod barline;
pub mod beam;
pub mod chord_symbol;
pub mod clef;
pub mod direction;
pub mod duration;
pub mod event;
pub mod key;
pub mod kit;
pub mod layout;
pub mod measure;
pub mod part;
pub mod pitch;
pub mod repeat;
pub mod score;
pub mod time;

pub use barline::*;
pub use beam::*;
pub use chord_symbol::*;
pub use clef::*;
pub use direction::*;
pub use duration::*;
pub use event::*;
pub use key::*;
pub use kit::*;
pub use layout::*;
pub use measure::*;
pub use part::*;
pub use pitch::*;
pub use repeat::*;
pub use score::*;
pub use time::*;
