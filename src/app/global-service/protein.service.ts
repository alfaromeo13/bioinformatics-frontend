import { ToastrService } from 'ngx-toastr';
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ProteinHttpService {

  /** Base URL of the backend API */
  public baseUrl = '/api';

  constructor(
    private http: HttpClient,
    private toastr: ToastrService
  ) { }

  /** Run the backend script */
  postData(form: any, pdbFile: File): Observable<any> {
    const formData = new FormData();
    formData.append('pdb_file', pdbFile);
    formData.append('protein_chains', form.protein_chains || '');
    formData.append('partner_chains', form.partner_chains || '');
    formData.append('mutations', form.mutations || '');
    formData.append('detect_interface', String(form.detect_interface));

    return this.http.post(`${this.baseUrl}/run-script`, formData).pipe(
      tap(() => this.toastr.success('Processing started!')),
      catchError((error) => this.handleError(error))
    );
  }

  /** Check result (no job ID now) */
  getResultList(jobId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/check-result/${jobId}`).pipe(
      catchError((error) => this.handleError(error))
    );
  }

  /** Retrieve file content */
  getFileContent(jobId: string, filename: string): Observable<string> {
    return this.http.get(`${this.baseUrl}/get-file/${jobId}/${filename}`, {
      responseType: 'text'
    });
  }

  /** Retrieves the live job log output from backend for display. */
  getJobLog(jobId: string) {
    return this.http.get(`${this.baseUrl}/get-log/${jobId}`);
  }

  /**
   * Unified HTTP error handler. Displays relevant messages using Toastr
   * and returns a failed observable.
   */
  private handleError(error: HttpErrorResponse) {
    queueMicrotask(() => {
      if (error.status === 400) this.toastr.warning('Please fill in all required fields');
      else if (error.status === 500) this.toastr.error('Server error (500)');
      else if (error.status === 202) this.toastr.info('Result still processing...');
      else this.toastr.error('Unexpected error occurred');
    });
    return throwError(() => error);
  }
}