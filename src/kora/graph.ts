// Живой граф процесса — построитель узлов из событий ReAct-петли.
// См. docs/PORTING_TO_TS.md раздел 8 и kora/orchestrator.py::_graph_set,
// _graph_node как построчный референс.
//
// Живой урок из ТЗ §8: граф должен показывать ЛЮБОЙ ход, не только
// декомпозированный — даже один шаг без единого вызова инструмента должен
// оставить в графе хотя бы узел "step1" + "final". Узлы обновляются ЖИВЬЁМ
// (apply() вызывается на каждое событие петли, а не постфактум).
//
// Чистый модуль без React — только импортирует тип LoopEvent из loop.ts.

import type { LoopEvent } from './loop.js';

export type GraphNodeStatus = 'queued' | 'running' | 'done' | 'failed';

export interface GraphNode {
  id: string;
  label: string;
  status: GraphNodeStatus;
  detail?: string;
  /** Разворачиваемое содержимое: размышление модели + краткая сводка результата. */
  thought?: string;
}

function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

/**
 * Строит и обновляет граф по событиям петли. Один инстанс — один ход
 * (аналог self.last_graph в Python-референсе, но без побочного состояния
 * оркестратора — просто накопитель узлов текущего вызова).
 */
export class GraphBuilder {
  private nodes: GraphNode[] = [];
  private byId = new Map<string, GraphNode>();
  /** Тип и узел последнего обработанного события — нужно, чтобы отличить
   * штатное завершение хода от эскалации (final сразу после blocked-серии
   * без успешного result между ними → последний рабочий узел считается
   * failed, не done). */
  private lastEventType: LoopEvent['type'] | null = null;
  private lastEventNodeId: string | null = null;

  /** Найти узел по id, создать (status: queued) если отсутствует — аналог _graph_node. */
  private node(id: string, label: string): GraphNode {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const n: GraphNode = { id, label, status: 'queued' };
    this.byId.set(id, n);
    this.nodes.push(n);
    return n;
  }

  private set(id: string, label: string, fields: Partial<GraphNode>): void {
    const n = this.node(id, label);
    Object.assign(n, fields);
  }

  /** Все running-узлы (кроме исключённого id) переводятся в done — используется
   * при переходе к следующему шагу и на финале. */
  private closeRunning(exceptId?: string): void {
    for (const n of this.nodes) {
      if (n.status === 'running' && n.id !== exceptId) n.status = 'done';
    }
  }

  /**
   * Принимает одно событие петли, возвращает АКТУАЛЬНЫЙ иммутабельный снимок
   * узлов (новый массив с новыми объектами-узлами — безопасно класть в
   * setState без риска "тот же объект, React не перерисует").
   */
  apply(evt: LoopEvent): GraphNode[] {
    const stepId = `step${evt.step}`;

    switch (evt.type) {
      case 'step_start': {
        this.closeRunning();
        this.set(stepId, evt.label ?? 'Думаю над ответом', { status: 'running' });
        break;
      }
      case 'action': {
        const n = this.node(stepId, evt.label ?? 'Продолжаю разбираться');
        const toolPart = evt.tool ? `вызываю ${evt.tool}` : 'вызываю инструмент';
        n.detail = n.detail ? `${n.detail}; ${toolPart}` : toolPart;
        const argsPart = evt.detail ? `→ ${evt.tool ?? ''}(${evt.detail})` : '';
        n.thought = n.thought ? `${n.thought}\n${argsPart}` : argsPart;
        break;
      }
      case 'result': {
        const n = this.node(stepId, 'Продолжаю разбираться');
        const summary = `${evt.tool ?? ''}: готово${evt.detail ? ` — ${truncate(evt.detail, 250)}` : ''}`;
        n.thought = n.thought ? `${n.thought}\n${summary}` : summary;
        break;
      }
      case 'blocked': {
        // Блок гарда — штатный ход петли (freshness-дозапрос, деним политики
        // и т.п.), НЕ обязательно провал узла — сверено с референсом:
        // _graph_set(..., status="done", detail=...) на дозапросе, а не failed.
        const n = this.node(stepId, evt.label ?? 'Продолжаю разбираться');
        if (evt.label) n.label = evt.label;
        const reason = `${evt.tool ? `${evt.tool}: ` : ''}заблокировано${evt.detail ? ` — ${truncate(evt.detail, 250)}` : ''}`;
        n.thought = n.thought ? `${n.thought}\n${reason}` : reason;
        break;
      }
      case 'final': {
        // Эскалация: последнее событие ДО final было blocked (серия провалов
        // без честного результата между ними) — последний рабочий узел
        // помечается failed, а не done.
        if (this.lastEventType === 'blocked' && this.lastEventNodeId) {
          const failedNode = this.byId.get(this.lastEventNodeId);
          if (failedNode) failedNode.status = 'failed';
        }
        this.closeRunning();
        this.set('final', evt.label ?? 'Собираю ответ', {
          status: 'done',
          detail: evt.detail,
        });
        break;
      }
    }

    this.lastEventType = evt.type;
    this.lastEventNodeId = evt.type === 'final' ? 'final' : stepId;

    // Иммутабельный снимок: новый массив, каждый узел — новый объект.
    return this.nodes.map((n) => ({ ...n }));
  }

  /** Текущий снимок без применения нового события. */
  snapshot(): GraphNode[] {
    return this.nodes.map((n) => ({ ...n }));
  }
}
