/**
 * 卡片字体选择（RAY-323）。
 *
 * 4 档卡片以 2×2 网格呈现（移动端单列、桌面端两列），每张卡片：
 * - 顶部一行：中文短名 + 已选时右侧显示对勾徽标（role="img" aria-label）；
 * - 中部：示例单词（用对应字体渲染，让用户在选择前就看清字面特征）；
 * - 底部一句：副描述（与短名一起形成 "字体名 + 一句定位" 的两行信息层）。
 *
 * 选区状态在父级持有（本组件纯受控）：父级从 useCardFont 读初值
 * 与写偏好，picker 只产出 id；选中态边框走主色（border-primary），
 * hover 走 surface-raised 反馈。色块全部走 design tokens，浅色/深色
 * 两套自动生效。
 *
 * 可访问性：
 * - 每张卡片是 role="radio"，整组在父级 <div role="radiogroup"> 内
 *   （见 SettingsScreen.tsx），配合 aria-checked 让读屏清晰播报档位与选中态；
 * - 键盘：原生单选组支持 Tab 进入 + 方向键切换（实施到外层容器）；
 * - 示例文本走 span（非 button 子节点），避免嵌套交互元素。
 */
import { CARD_FONT_OPTIONS, type CardFont } from "../lib/cardFont";

export interface FontPickerProps {
  /** 当前选中的字体档位（父级受控） */
  value: CardFont;
  /** 用户点击某档时的回调，参数为目标档位 */
  onChange(next: CardFont): void;
  /** 单选组说明（外层 radiogroup 的 aria-label） */
  groupLabel: string;
}

export function FontPicker({ value, onChange, groupLabel }: FontPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {CARD_FONT_OPTIONS.map((option) => {
        const selected = option.id === value;
        // radio 标签：用 <label> 包裹 input[type=radio]，原生提供
        // 点击/键盘/读屏三件套，比 button+role=radio 多了浏览器对
        // label-for 与单选组 name 的内置支持；外层 <label> 整张卡片
        // 都可点击，体验与 button+role 相同，无障碍行为更强。
        return (
          <label
            key={option.id}
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border bg-surface p-4 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring hover:bg-surface-raised ${
              selected ? "border-primary" : "border-border"
            }`}
          >
            <input
              type="radio"
              name="card-font"
              value={option.id}
              checked={selected}
              onChange={() => onChange(option.id)}
              className="sr-only"
            />
            <span className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span>{option.label}</span>
              {selected ? (
                <span
                  role="img"
                  aria-label="已选中"
                  className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-contrast"
                >
                  已选
                </span>
              ) : null}
            </span>
            <span
              className="text-2xl font-bold leading-tight sm:text-3xl"
              style={{ fontFamily: option.fontFamily }}
              lang="en"
            >
              {option.sampleText}
            </span>
            <span className="text-xs text-text-muted">{option.description}</span>
          </label>
        );
      })}
    </div>
  );
}
