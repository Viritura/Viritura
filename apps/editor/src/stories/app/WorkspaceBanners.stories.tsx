import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppBanners } from "../../app/AppBanners";

const meta: Meta<typeof AppBanners> = {
  title: "App/Workspace Banners",
  component: AppBanners,
  args: {
    isDragOver: false,
    fileError: null,
    trackBannerFile: null,
    handleTrackWithGit: () => {},
    handleDismissTrackBanner: () => {},
    printOverflowPages: [],
  },
};

export default meta;

export const PrintOverflow: StoryObj<typeof AppBanners> = {
  args: {
    printOverflowPages: Array.from({ length: 120 }, (_, index) => index + 1),
  },
  name: "Print margin overflow",
};
