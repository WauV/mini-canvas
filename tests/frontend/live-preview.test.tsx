import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Editor } from "../../app/components/Editor";
import type {
  LivePreviewInteractions,
  ResolvedEmbed,
} from "../../app/lib/obsidian-interactions";

const PREVIEW_SOURCE = [
  "把光标留在这里",
  "",
  "# 标题",
  "",
  "> [!warning] 注意事项",
  "> Callout 正文",
  "",
  "- [ ] 待办任务",
  "- 普通列表",
  "1. 有序列表",
  "",
  "[[目标笔记|别名]] 与 ![[附件.png]]",
  "![图片](images/demo.png)",
  "",
  "正文[^ref] 与 ^[行内脚注]，还有 $E = mc^2$。",
  "",
  "[^ref]: 脚注正文",
  "",
  "$$",
  "\\int_0^1 x^2 dx",
  "$$",
  "",
  "| 名称 | 状态 |",
  "| --- | --- |",
  "| Mini Canvas | 正常 |",
  "",
  "---",
  "",
  "**粗体** _斜体_ ~~删除~~ ==高亮== `code` #标签",
  "",
  "可引用段落 ^demo",
  "",
  "%%隐藏注释%%",
].join("\n");

describe("Obsidian Live Preview DOM", () => {
  test("为主要语法创建可交互组件且任务勾选会更新原文", async () => {
    const onChange = vi.fn();
    render(<Editor content={PREVIEW_SOURCE} mode="live" onChange={onChange} />);
    const host = screen.getByLabelText("Markdown 编辑器");

    await waitFor(() => {
      expect(host.querySelector(".cm-obsidian-wikilink-widget")).toBeInTheDocument();
      expect(host.querySelector(".cm-live-math-inline")).toBeInTheDocument();
      expect(host.querySelector(".cm-live-math-block")).toBeInTheDocument();
      expect(host.querySelector(".cm-table-widget table")).toBeInTheDocument();
    });
    expect(host.querySelector(".cm-callout-label")).toHaveTextContent("WARNING");
    expect(host.querySelector(".cm-horizontal-rule-widget")).toHaveAttribute(
      "aria-label",
      "分隔线",
    );
    expect(host.querySelectorAll(".cm-footnote-widget")).toHaveLength(2);
    expect(host.querySelector(".cm-comment-widget")).toHaveTextContent("隐藏注释");
    expect(host.querySelector(".cm-block-id-widget")).toHaveTextContent("demo");
    expect(host.querySelector(".cm-live-strong")).toHaveTextContent("粗体");
    expect(host.querySelector(".cm-live-inline-code")).toHaveTextContent("code");

    const checkbox = screen.getByRole("checkbox", { name: "标记为已完成" });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain("- [x] 待办任务"),
    );
  });

  test("点击 Wiki Link 组件会回到对应源码范围", async () => {
    render(
      <Editor content={PREVIEW_SOURCE} mode="live" onChange={() => undefined} />,
    );
    const host = screen.getByLabelText("Markdown 编辑器");
    const widget = await waitFor(() => {
      const item = host.querySelector<HTMLElement>(".cm-obsidian-wikilink-widget");
      expect(item).toBeInTheDocument();
      return item!;
    });

    const open = widget.querySelector<HTMLButtonElement>(".cm-wikilink-open")!;
    fireEvent.mouseDown(open);
    fireEvent.click(open);

    await waitFor(() =>
      expect(host.querySelector(".cm-wikilink-source")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Markdown 内容")).toHaveFocus();
  });

  test("安全 SVG 使用临时对象地址并在卸载时释放", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mini-canvas-test");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const source = [
      "开头",
      "",
      "```svg",
      '<svg viewBox="0 0 10 10"><circle r="4" /></svg>',
      "```",
    ].join("\n");
    const view = render(
      <Editor content={source} mode="live" onChange={() => undefined} />,
    );

    const image = await screen.findByRole("img", { name: "SVG 图形预览" });
    expect(image).toHaveAttribute("src", "blob:mini-canvas-test");
    expect(createObjectUrl).toHaveBeenCalledOnce();

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:mini-canvas-test");
  });

  test("损坏的 SVG 显示错误而不是让编辑器崩溃", async () => {
    const source = ["开头", "", "```svg", "<svg><g></svg>", "```"].join(
      "\n",
    );
    render(<Editor content={source} mode="live" onChange={() => undefined} />);

    expect(await screen.findByText("SVG 无法预览")).toBeInTheDocument();
    expect(screen.getByText("SVG XML 格式不完整")).toBeInTheDocument();
  });

  test("异步解析图片 Embed，并分别支持 Wiki 导航和源码编辑", async () => {
    const openWikiLink = vi.fn().mockResolvedValue(undefined);
    const resolveEmbed = vi.fn().mockResolvedValue({
      kind: "image",
      path: "Assets/示意图.png",
      mimeType: "image/png",
      revision: "2-image",
      size: 2,
      source: "data:image/png;base64,aGk=",
    } satisfies ResolvedEmbed);
    const interactions: LivePreviewInteractions = { resolveEmbed, openWikiLink };
    render(
      <Editor
        content={"开头\n\n[[目标笔记#章节|打开目标]]\n\n![[示意图.png|320x180]]"}
        mode="live"
        onChange={() => undefined}
        livePreviewInteractions={interactions}
      />,
    );

    const image = await screen.findByRole("img", { name: "示意图.png" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,aGk=");
    expect(image).toHaveStyle({ width: "320px", height: "180px" });
    expect(resolveEmbed).toHaveBeenCalledWith({
      target: "示意图.png",
      path: "示意图.png",
      subpath: "",
      label: "示意图.png",
      width: 320,
      height: 180,
    });

    const openWikiButton = screen.getByRole("button", {
      name: "打开 Wiki Link：打开目标",
    });
    fireEvent.mouseDown(openWikiButton);
    fireEvent.click(openWikiButton);
    await waitFor(() =>
      expect(openWikiLink).toHaveBeenCalledWith({
        target: "目标笔记#章节",
        path: "目标笔记",
        subpath: "#章节",
        label: "打开目标",
      }),
    );

    const editButtons = screen.getAllByRole("button", { name: "编辑" });
    fireEvent.mouseDown(editButtons.at(-1)!);
    fireEvent.click(editButtons.at(-1)!);
    await waitFor(() =>
      expect(
        screen.getByLabelText("Markdown 编辑器").querySelector(".cm-embed-source"),
      ).toBeInTheDocument(),
    );
  });

  test("异步 Embed 安全渲染 SVG、文本、元数据、笔记卡和错误状态", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:resolved-svg");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const openWikiLink = vi.fn().mockResolvedValue(undefined);
    const resolutions: Record<string, ResolvedEmbed | Error> = {
      "diagram.svg": {
        kind: "svg",
        path: "Assets/diagram.svg",
        mimeType: "image/svg+xml",
        revision: "1-svg",
        size: 20,
        source: '<svg viewBox="0 0 10 10"><script>alert(1)</script><circle r="4" /></svg>',
      },
      "data.txt": {
        kind: "text",
        path: "Assets/data.txt",
        mimeType: "text/plain",
        revision: "1-text",
        size: 21_000,
        source: "a".repeat(20_001),
      },
      "archive.zip": {
        kind: "metadata",
        path: "Assets/archive.zip",
        mimeType: "application/zip",
        revision: "1-zip",
        size: 30,
      },
      Note: { kind: "note", path: "Notes/Note.md" },
      "missing.png": new Error("Vault 中找不到：missing.png"),
      "broken.svg": {
        kind: "svg",
        path: "Assets/broken.svg",
        mimeType: "image/svg+xml",
        revision: "1-broken",
        size: 10,
        source: "<svg><g></svg>",
      },
    };
    const interactions: LivePreviewInteractions = {
      openWikiLink,
      async resolveEmbed(request) {
        const result = resolutions[request.path];
        if (!result) throw new Error("测试缺少 Embed 结果");
        if (result instanceof Error) throw result;
        return result;
      },
    };
    const content = [
      "开头",
      "",
      "![[diagram.svg|200x100]]",
      "",
      "![[data.txt]]",
      "",
      "![[archive.zip]]",
      "",
      "![[Note]]",
      "",
      "![[missing.png]]",
      "",
      "![[broken.svg]]",
    ].join("\n");
    const view = render(
      <Editor
        content={content}
        mode="live"
        onChange={() => undefined}
        livePreviewInteractions={interactions}
      />,
    );

    expect(await screen.findByRole("img", { name: "diagram.svg" }))
      .toHaveAttribute("src", "blob:resolved-svg");
    expect(screen.getByRole("img", { name: "diagram.svg" })).toHaveStyle({
      width: "200px",
      height: "100px",
    });
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(await screen.findByText("预览已截断，源文件未改变")).toBeInTheDocument();
    expect(screen.getByText("此附件只提供元数据 · application/zip")).toBeInTheDocument();
    expect(screen.getByText("笔记嵌入 · Notes/Note.md")).toBeInTheDocument();
    expect(screen.getByText("Vault 中找不到：missing.png")).toBeInTheDocument();
    expect(screen.getByText("SVG XML 格式不完整")).toBeInTheDocument();

    const openNote = screen.getByRole("button", { name: "打开笔记" });
    fireEvent.mouseDown(openNote);
    fireEvent.click(openNote);
    await waitFor(() => expect(openWikiLink).toHaveBeenCalled());

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:resolved-svg");
  });

  test("未连接 resolver 时 Embed 仍可返回源码，导航失败会标记组件", async () => {
    const first = render(
      <Editor
        content={"开头\n\n![[offline.png]]"}
        mode="live"
        onChange={() => undefined}
      />,
    );
    expect(await screen.findByText("附件预览尚未连接")).toBeInTheDocument();
    const embed = screen
      .getByLabelText("Markdown 编辑器")
      .querySelector<HTMLElement>(".cm-obsidian-embed-widget")!;
    fireEvent.mouseDown(embed);
    await waitFor(() =>
      expect(
        screen.getByLabelText("Markdown 编辑器").querySelector(".cm-embed-source"),
      ).toBeInTheDocument(),
    );
    first.unmount();

    render(
      <Editor
        content={"开头\n\n[[Missing]]"}
        mode="live"
        onChange={() => undefined}
        livePreviewInteractions={{
          async openWikiLink() {
            throw new Error("导航目标不存在");
          },
        }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "打开 Wiki Link：Missing" }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("Markdown 编辑器").querySelector(".has-error"),
      ).toHaveAttribute("title", "导航目标不存在"),
    );
  });
});
