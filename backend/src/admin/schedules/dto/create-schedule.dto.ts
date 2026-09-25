import { IsUUID, IsDateString, IsNumber, Min, IsOptional, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchedulePointDto } from './schedule-point.dto';

export class CreateScheduleDto {
  @ApiProperty()
  @IsUUID()
  busId: string;

  @ApiProperty()
  @IsUUID()
  routeId: string;

  @ApiProperty({ example: '2026-09-17T00:00:00.000Z' })
  @IsDateString()
  departureTime: string;

  @ApiProperty({ example: '2026-09-17T05:00:00.000Z' })
  @IsDateString()
  arrivalTime: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  fare: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceCharge?: number;

  @ApiProperty({ type: [SchedulePointDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SchedulePointDto)
  boardingPoints: SchedulePointDto[];

  @ApiProperty({ type: [SchedulePointDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SchedulePointDto)
  droppingPoints: SchedulePointDto[];
}
