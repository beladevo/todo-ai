import {Component, signal} from '@angular/core';
import {MatButton, MatFabButton, MatIconButton} from '@angular/material/button';
import {MatCheckbox} from '@angular/material/checkbox';
import {MatIcon} from '@angular/material/icon';
import {MatList, MatListItem} from '@angular/material/list';
import {NavComponent} from './nav/nav.component';
import {type Todo} from './todo';
import {MatFormField, MatLabel} from '@angular/material/form-field';
import {MatInput} from '@angular/material/input';
import {MatProgressBar} from '@angular/material/progress-bar';
import {ChatCompletionMessageParam, CreateMLCEngine, MLCEngine} from '@mlc-ai/web-llm';

@Component({
  selector: 'app-root',
  imports: [NavComponent, MatFabButton, MatIcon, MatIconButton, MatLabel, MatList, MatListItem, MatCheckbox, MatFormField, MatInput, MatButton, MatProgressBar],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  protected readonly todos = signal<Todo[]>([
    {text: 'Wash clothes', done: true},
    {text: 'Wash my car', done: true},
    {text: 'Pet the dog', done: false},
  ]);
  protected readonly ready = signal(false);
  protected readonly progress = signal(0);
  protected readonly reply = signal('');
  protected engine?: MLCEngine;

  async ngOnInit() {
    const model = 'Llama-3.2-3B-Instruct-q4f32_1-MLC';
    this.engine = await CreateMLCEngine(model, {
      initProgressCallback: ({progress}) =>
        this.progress.set(progress)
    });
    this.ready.set(true);
  }

  addTodo() {
    const text = prompt('Enter a new todo.');
    if (text == null) {
      return;
    }

    this.todos.update(todos => [...todos, {text, done: false}]);
  }

  deleteTodo(todo: Todo) {
    this.todos.update(todos => todos.filter(t => t !== todo));
  }

  toggleTodo(todo: Todo) {
    this.todos.update(todos => todos.map(t => t !== todo ? t : {...t, done: !t.done}));
  }

  async runPrompt(userPrompt: string) {
    this.reply.set('…');

    await this.engine!.resetChat();
    const systemPrompt = `You are a helpful assistant managing the user's todo list.
Current todo list:
${this.todos().map(todo => `* ${todo.text} (${todo.done ? 'done' : 'not done'})`).join('\n')}

To add or delete a task, output ONLY a JSON object on a single line, nothing else:
{"tool":"add_task","text":"<task text>"}
{"tool":"delete_task","text":"<exact task text>"}

For any other request, reply normally in plain text.`;

    const messages: ChatCompletionMessageParam[] = [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: userPrompt}
    ];

    const response = await this.engine!.chat.completions.create({messages, stream: false});
    const content = response.choices[0].message.content ?? '';

    let toolResult: string | null = null;
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed.tool === 'add_task' && parsed.text) {
        this.todos.update(todos => [...todos, {text: parsed.text, done: false}]);
        toolResult = `Task "${parsed.text}" added successfully.`;
      } else if (parsed.tool === 'delete_task' && parsed.text) {
        const found = this.todos().find(t => t.text.toLowerCase() === parsed.text.toLowerCase());
        if (found) {
          this.todos.update(todos => todos.filter(t => t !== found));
          toolResult = `Task "${found.text}" deleted successfully.`;
        } else {
          toolResult = `Task "${parsed.text}" was not found in the list.`;
        }
      }
    } catch {
    }

    if (toolResult !== null) {
      messages.push({role: 'assistant', content});
      messages.push({role: 'user', content: `Result: ${toolResult}. Confirm to the user what happened in one sentence.`});
      const chunks = await this.engine!.chat.completions.create({messages, stream: true});
      let reply = '';
      for await (const chunk of chunks) {
        reply += chunk.choices[0]?.delta.content ?? '';
        this.reply.set(reply);
      }
    } else {
      this.reply.set(content);
    }
  }
}
