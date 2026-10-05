use super::*;
use std::collections::HashSet;

impl DisplayList {
    /// Staff knockouts are overlays: later staff/barline rendering must not paint
    /// through them. Page furniture retains its authored order above musical ink.
    pub fn with_raised_text_frames(mut self) -> Self {
        self.raise_text_frames();
        self
    }

    fn raise_text_frames(&mut self) {
        let ids: HashSet<String> = self
            .commands
            .iter()
            .enumerate()
            .filter(|(_, command)| matches!(command, RenderCommand::EraseRect { .. }))
            .filter_map(|(index, _)| self.element_ids.get(index)?.as_ref())
            .filter(|id| id.contains("/expr"))
            .cloned()
            .collect();
        if ids.is_empty() {
            return;
        }
        let page_start = self
            .element_ids
            .iter()
            .position(|id| id.as_ref().is_some_and(|id| id.starts_with("text-frame/")))
            .unwrap_or(self.commands.len());
        let first_frame = self
            .element_ids
            .iter()
            .position(|id| id.as_ref().is_some_and(|id| ids.contains(id)))
            .unwrap();
        if first_frame >= page_start
            || self.commands[first_frame..page_start]
                .iter()
                .enumerate()
                .all(|(offset, command)| {
                    matches!(command, RenderCommand::SetOpacity { .. })
                        || self.element_ids[first_frame + offset]
                            .as_ref()
                            .is_some_and(|id| ids.contains(id))
                })
        {
            return;
        }
        let mut order: Vec<usize> = (0..page_start)
            .filter(|index| {
                !self
                    .element_ids
                    .get(*index)
                    .and_then(Option::as_ref)
                    .is_some_and(|id| ids.contains(id))
            })
            .collect();
        order.extend((0..page_start).filter(|index| {
            self.element_ids
                .get(*index)
                .and_then(Option::as_ref)
                .is_some_and(|id| ids.contains(id))
        }));
        order.extend(page_start..self.commands.len());
        let mut opacities = Vec::with_capacity(self.commands.len());
        let mut alpha = 1.0;
        for command in &self.commands {
            if let RenderCommand::SetOpacity { opacity } = command {
                alpha = *opacity;
            }
            opacities.push(alpha);
        }
        let commands = std::mem::take(&mut self.commands);
        let element_ids = std::mem::take(&mut self.element_ids);
        let mut mapping = vec![0; commands.len()];
        alpha = 1.0;
        for index in order {
            if opacities[index] != alpha {
                alpha = opacities[index];
                self.commands
                    .push(RenderCommand::SetOpacity { opacity: alpha });
                self.element_ids.push(None);
            }
            mapping[index] = self.commands.len() as u32;
            self.commands.push(commands[index].clone());
            self.element_ids
                .push(element_ids.get(index).cloned().unwrap_or(None));
        }
        for shape in &mut self.element_shapes {
            if let ShapeGeom::Cmd { cmd_idx } = &mut shape.geom {
                *cmd_idx = mapping[*cmd_idx as usize];
            }
        }
    }
}
