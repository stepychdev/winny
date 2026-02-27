import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SocialActivityCard } from "./SocialActivityCard";

let hookState: { activities: any[]; loading: boolean } = {
  activities: [],
  loading: false,
};

vi.mock("../../hooks/useTapestryActivityFeed", () => ({
  useTapestryActivityFeed: () => hookState,
}));

describe("SocialActivityCard", () => {
  beforeEach(() => {
    hookState = { activities: [], loading: false };
  });

  test("renders nothing without wallet", () => {
    const { container } = render(<SocialActivityCard walletAddress={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows loading state", () => {
    hookState = { activities: [], loading: true };
    render(<SocialActivityCard walletAddress="wallet1" />);
    // Skeleton placeholders render instead of text; verify header still shows
    expect(screen.getByText(/social feed/i)).toBeInTheDocument();
  });

  test("renders empty state", () => {
    render(<SocialActivityCard walletAddress="wallet1" />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  test("renders activity items", () => {
    hookState = {
      loading: false,
      activities: [
        {
          id: "a1",
          type: "following",
          actorProfileId: "p1",
          actorUsername: "alice",
          timestamp: Math.floor(Date.now() / 1000) - 30,
          activity: "alice followed bob",
          targetUsername: "bob",
        },
        {
          id: "a2",
          type: "comment",
          actorProfileId: "p2",
          actorUsername: "charlie",
          timestamp: Math.floor(Date.now() / 1000) - 90,
          activity: "charlie commented on a post",
        },
      ],
    };

    render(<SocialActivityCard walletAddress="wallet1" />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText(/alice followed bob/i)).toBeInTheDocument();
    expect(screen.getByText(/→ @bob/i)).toBeInTheDocument();
    expect(screen.getByText("@charlie")).toBeInTheDocument();
  });
});
