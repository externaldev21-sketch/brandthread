/**
 * Static scan for icon-only pressables with no accessibility label.
 *
 * A pressable (Pressable / PressableScale / TouchableOpacity / TouchableWithoutFeedback)
 * is "icon-only" when its children contain an icon element (Feather / Ionicons /
 * MaterialIcons / ...Icon) and no <Text>/<AppText> and no expression that could render
 * text. It is "labeled" when it carries `accessibilityLabel` / `aria-label`, or spreads
 * props (`{...rest}`), which we cannot see through and so give the benefit of the doubt.
 * Used by tests/a11y-icon-only-lint.test.ts, which compares against a baseline so it
 * passes on today's code and fails on any NEW unlabeled icon-only pressable.
 */
import ts from 'typescript';

const PRESSABLES = new Set(['Pressable', 'PressableScale', 'TouchableOpacity', 'TouchableWithoutFeedback', 'TouchableHighlight']);
const ICON_TAG = /^(Feather|Ionicons|MaterialIcons|MaterialCommunityIcons|FontAwesome|FontAwesome5|AntDesign|Entypo|[A-Za-z]*Icon)$/;
const TEXT_TAGS = new Set(['Text', 'AppText', 'Animated.Text']);

export interface IconOnlyFinding {
  line: number;
  tag: string;
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

function hasLabel(node: ts.JsxOpeningLikeElement): boolean {
  for (const attr of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attr)) return true;
    const name = attr.name.getText();
    if (name === 'accessibilityLabel' || name === 'aria-label' || name === 'accessibilityLabelledBy') return true;
    // `accessible={false}` removes the control from the accessibility tree on purpose.
    if (name === 'accessible' && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression?.getText() === 'false') return true;
  }
  return false;
}

interface ChildInfo { icon: boolean; text: boolean }

function scanChildren(children: readonly ts.JsxChild[], info: ChildInfo): void {
  for (const child of children) {
    if (ts.isJsxText(child)) {
      if (child.text.trim()) info.text = true;
    } else if (ts.isJsxElement(child)) {
      scanElement(child.openingElement, child.children, info);
    } else if (ts.isJsxSelfClosingElement(child)) {
      scanElement(child, [], info);
    } else if (ts.isJsxFragment(child)) {
      scanChildren(child.children, info);
    } else if (ts.isJsxExpression(child) && child.expression) {
      // Any expression that is not plainly an element could render text; be conservative,
      // except a bare conditional/&& around elements, which we descend into.
      walkExpression(child.expression, info);
    }
  }
}

function scanElement(open: ts.JsxOpeningLikeElement, children: readonly ts.JsxChild[], info: ChildInfo): void {
  const name = tagName(open);
  if (TEXT_TAGS.has(name)) { info.text = true; return; }
  if (ICON_TAG.test(name)) info.icon = true;
  scanChildren(children, info);
}

function walkExpression(expr: ts.Expression, info: ChildInfo): void {
  if (ts.isJsxElement(expr)) return scanElement(expr.openingElement, expr.children, info);
  if (ts.isJsxSelfClosingElement(expr)) return scanElement(expr, [], info);
  if (ts.isJsxFragment(expr)) return scanChildren(expr.children, info);
  if (ts.isParenthesizedExpression(expr)) return walkExpression(expr.expression, info);
  if (ts.isConditionalExpression(expr)) { walkExpression(expr.whenTrue, info); walkExpression(expr.whenFalse, info); return; }
  if (ts.isBinaryExpression(expr) && (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expr.operatorToken.kind === ts.SyntaxKind.BarBarToken || expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    walkExpression(expr.right, info);
    return;
  }
  if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr) || ts.isTemplateExpression(expr) || ts.isStringLiteral(expr)) {
    // `{children}`, `{label}`, `{fn()}`: unknown content that may well be text.
    info.text = true;
  }
}

/** Returns one finding per icon-only pressable that has no accessibility label. */
export function findUnlabeledIconOnlyPressables(fileName: string, source: string): IconOnlyFinding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: IconOnlyFinding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const open = node.openingElement;
      const name = tagName(open);
      if (PRESSABLES.has(name) && !hasLabel(open)) {
        const info: ChildInfo = { icon: false, text: false };
        scanChildren(node.children, info);
        if (info.icon && !info.text) {
          out.push({ line: sf.getLineAndCharacterOfPosition(open.getStart()).line + 1, tag: name });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
