import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Editor } from "../../app/components/Editor";

describe("Editor CodeMirror 适配层", () => {
  test("挂载真实 CodeMirror 并通过工具栏产生受控内容变更", async () => {
    const onChange = vi.fn();
    render(<Editor content="正文" mode="live" onChange={onChange} />);

    const editable = screen.getByLabelText("Markdown 内容");
    expect(editable).toHaveTextContent("正文");
    expect(screen.getByRole("toolbar", { name: "Markdown 格式" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "粗体" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("**粗体文本**");
  });

  test("外部内容、源码模式与只读状态会增量同步到同一个编辑器", async () => {
    const onChange = vi.fn();
    const view = render(
      <Editor content="# 旧标题" mode="live" onChange={onChange} />,
    );

    const host = screen.getByLabelText("Markdown 编辑器");
    const editorElement = screen.getByLabelText("Markdown 内容");
    view.rerender(
      <Editor content="# 新标题" mode="source" onChange={onChange} readOnly />,
    );

    await waitFor(() => expect(editorElement).toHaveTextContent("# 新标题"));
    expect(host.querySelector(".cm-gutters")).toBeInTheDocument();
    expect(editorElement).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "粗体" })).toBeDisabled();
  });

  test("卸载会销毁编辑器节点且不会遗留可编辑区域", () => {
    const view = render(
      <Editor content="临时内容" mode="live" onChange={() => undefined} />,
    );
    expect(screen.getByLabelText("Markdown 内容")).toBeInTheDocument();

    view.unmount();

    expect(screen.queryByLabelText("Markdown 内容")).not.toBeInTheDocument();
  });
});
