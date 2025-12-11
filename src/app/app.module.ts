import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { HttpClientModule } from '@angular/common/http';
import { ProteinViewerComponent } from './protein-viewer/protein-viewer.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import { SpinnerComponent } from './spinner-component/spinner.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { PdbInputFormComponent } from './pdb-input-form/pdb-input-form.component';
import { NglViewerComponent } from './ngl-viewer/ngl-viewer.component';
import { MutationAnalysisComponent } from './mutation-analysis/mutation-analysis.component';

@NgModule({
  declarations: [
    AppComponent,
    ProteinViewerComponent,
    SpinnerComponent,
    DashboardComponent,
    PdbInputFormComponent,
    NglViewerComponent,
    MutationAnalysisComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    BrowserAnimationsModule,
    ToastrModule.forRoot({
      positionClass: 'toast-top-right',
      timeOut: 3500,
      preventDuplicates: true,
    }),
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
