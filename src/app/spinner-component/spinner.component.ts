import { Component, ViewEncapsulation } from '@angular/core';
import { SpinnerComponentService } from './spinner.component.service';

@Component({
  selector: 'app-spinner-component',
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.css',
  encapsulation: ViewEncapsulation.ShadowDom
})
export class SpinnerComponent {
  jobLog: string = '';
  constructor(public loader: SpinnerComponentService) { }
}