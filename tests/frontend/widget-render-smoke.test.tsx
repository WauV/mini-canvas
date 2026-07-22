import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { MiniCanvas } from "../../app/MiniCanvas";

test("renders the real CodeMirror editor shell in Widget mode", async () => {
  render(<MiniCanvas hostMode="widget" />);

  expect(
    await screen.findByRole("main"),
  ).toHaveClass("is-widget");
  expect(screen.getByRole("toolbar", { name: "Markdown 格式" })).toBeVisible();
  expect(screen.getByLabelText("Markdown 编辑器")).toBeVisible();
});
