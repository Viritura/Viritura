//! Display list — render commands that the Canvas painter executes.
//!
//! The engine produces a flat list of these commands after layout.
//! The TypeScript renderer iterates them and calls Canvas 2D / WebGL APIs.

pub mod binary;
pub mod smufl;
pub mod svg;

mod command;
mod debug;
mod display_list;
mod types;

pub use command::*;
pub use debug::*;
pub use display_list::*;
pub use types::*;
