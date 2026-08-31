import { configure } from "@testing-library/react";

// Every `render`/`renderHook` mounts under StrictMode, so effects still get the
// mount→cleanup→mount double-invoke that the dev server no longer applies.
configure({ reactStrictMode: true });
